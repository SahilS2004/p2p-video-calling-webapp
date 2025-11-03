import React, { useState, useRef, useEffect } from 'react';
import './VideoCall.css';

const VideoCall = () => {
  const [localIP, setLocalIP] = useState('');
  const [serverIP, setServerIP] = useState('localhost');
  const [peerIP, setPeerIP] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [error, setError] = useState('');
  const [localVideoStarted, setLocalVideoStarted] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const wsRef = useRef(null);
  const localStreamRef = useRef(null);

  // Get local IP address
  useEffect(() => {
    const getLocalIPAddress = async () => {
      try {
        // Try WebRTC trick to get local IP
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pc.createDataChannel('');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidate = event.candidate.candidate;
            const ipMatch = candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
            if (ipMatch && ipMatch[1] && ipMatch[1] !== '127.0.0.1') {
              setLocalIP(ipMatch[1]);
              pc.close();
            }
          }
        };
      } catch (err) {
        console.error('Error getting local IP:', err);
        setLocalIP('Unable to detect');
      }
    };

    getLocalIPAddress();
  }, []);

  // Connect to signaling server
  const connectToServer = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${serverIP}:3001`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to signaling server');
        setError('');
        // Register with server
        ws.send(JSON.stringify({
          type: 'register',
          localIP: localIP
        }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleSignalingMessage(data);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Failed to connect to signaling server. Make sure the server is running.');
      };

      ws.onclose = () => {
        console.log('Disconnected from signaling server');
        setIsConnected(false);
        setConnectionStatus('disconnected');
      };
    } catch (err) {
      console.error('Error creating WebSocket:', err);
      setError('Failed to create WebSocket connection.');
    }
  };

  // Handle signaling messages
  const handleSignalingMessage = async (data) => {
    switch (data.type) {
      case 'registered':
        setServerIP(data.serverIP || serverIP);
        setIsConnected(true);
        setConnectionStatus('connected');
        break;

      case 'offer':
        await handleOffer(data);
        break;

      case 'answer':
        await handleAnswer(data);
        break;

      case 'ice-candidate':
        await handleIceCandidate(data);
        break;

      default:
        console.log('Unknown message type:', data.type);
    }
  };

  // Initialize WebRTC
  const initializePeerConnection = () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);
    peerConnectionRef.current = pc;

    // Add local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (remoteVideoRef.current && event.streams && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        // Ensure video plays
        remoteVideoRef.current.play().catch(err => {
          console.error('Error playing remote video:', err);
        });
        setConnectionStatus('connected');
        console.log('Remote video stream set');
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && peerIP) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetIP: peerIP
        }));
        console.log('Sent ICE candidate to:', peerIP);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('Peer connection state changed:', state);
      setConnectionStatus(state);
      if (state === 'failed' || state === 'disconnected') {
        setError('Connection failed. Please try again.');
        setIsConnecting(false);
      } else if (state === 'connected') {
        setIsConnecting(false);
        setError('');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.warn('ICE connection failed, trying restart...');
        pc.restartIce();
      }
    };

    return pc;
  };

  // Start local video
  const startLocalVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        // Ensure video plays
        localVideoRef.current.play().catch(err => {
          console.error('Error playing local video:', err);
        });
        setLocalVideoStarted(true);
        console.log('Local video started');
      }
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setError('Failed to access camera/microphone. Please grant permissions.');
      setLocalVideoStarted(false);
    }
  };

  // Stop local video
  const stopLocalVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setLocalVideoStarted(false);
  };

  // Connect to peer
  const connectToPeer = async () => {
    if (!peerIP) {
      setError('Please enter peer IP address');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to signaling server');
      return;
    }

    setIsConnecting(true);
    setError('');

    // Start local video first
    await startLocalVideo();

    // Initialize peer connection
    const pc = initializePeerConnection();

    try {
      // Create and send offer
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });
      await pc.setLocalDescription(offer);

      console.log('Sending offer to:', peerIP);
      wsRef.current.send(JSON.stringify({
        type: 'offer',
        offer: offer,
        targetIP: peerIP
      }));

      setConnectionStatus('connecting');
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to create connection offer');
      setIsConnecting(false);
    }
  };

  // Handle incoming offer
  const handleOffer = async (data) => {
    console.log('Received offer from:', data.fromIP);
    
    if (!data.fromIP) {
      setError('Received offer without sender IP');
      return;
    }
    
    // Set peer IP from the offer sender BEFORE initializing connection
    // so ICE candidates can be sent to the correct peer
    setPeerIP(data.fromIP);
    
    await startLocalVideo();
    
    // Initialize peer connection (will use peerIP from closure after state update)
    // For immediate use, we'll pass the IP directly via the ICE candidate handler
    const pc = initializePeerConnection();

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          answer: answer,
          targetIP: data.fromIP
        }));
        console.log('Sent answer to:', data.fromIP);
      }
      
      // Override ICE candidate handler to use the correct IP immediately
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate,
            targetIP: data.fromIP  // Use the offer sender's IP directly
          }));
          console.log('Sent ICE candidate to:', data.fromIP);
        }
      };
    } catch (err) {
      console.error('Error handling offer:', err);
      setError('Failed to handle connection offer');
    }
  };

  // Handle incoming answer
  const handleAnswer = async (data) => {
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
        setIsConnecting(false);
      }
    } catch (err) {
      console.error('Error handling answer:', err);
      setError('Failed to handle connection answer');
    }
  };

  // Handle ICE candidate
  const handleIceCandidate = async (data) => {
    try {
      if (!peerConnectionRef.current) {
        console.warn('Received ICE candidate but no peer connection');
        return;
      }
      
      if (data.candidate) {
        // Check if remote description is set
        if (peerConnectionRef.current.remoteDescription) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
          console.log('Added ICE candidate from:', data.fromIP);
        } else {
          // Store candidate to add later (shouldn't happen normally but safe to handle)
          console.log('ICE candidate received before remote description, will be added later');
          // Add it anyway - modern WebRTC implementations handle this
          try {
            await peerConnectionRef.current.addIceCandidate(
              new RTCIceCandidate(data.candidate)
            );
          } catch (e) {
            console.warn('Could not add ICE candidate yet:', e);
          }
        }
      }
    } catch (err) {
      // Ignore errors for invalid candidates or when connection is closed
      if (err.message && !err.message.includes('closed') && !err.message.includes('Invalid')) {
        console.warn('ICE candidate error (may be normal):', err);
      }
    }
  };

  // Disconnect
  const disconnect = () => {
    // Close peer connection (but keep local video)
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear remote video only
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setConnectionStatus('disconnected');
    setPeerIP('');
    setError('');
    // Note: We don't stop local video here, only on cleanup
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop all streams on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      disconnect();
    };
  }, []);

  return (
    <div className="video-call-container">
      <div className="video-call-header">
        <h1>🎥 P2P Video Calling</h1>
        <p className="subtitle">Connect over your local WiFi network</p>
      </div>

      <div className="info-panel">
        <div className="info-item">
          <span className="info-label">📤 Share This IP:</span>
          <span className="info-value" style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#667eea' }}>
            {localIP || 'Detecting...'}
          </span>
          <span style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>
            This is your IP address - share it with your peer
          </span>
        </div>
        <div className="info-item">
          <span className="info-label">Server:</span>
          <span className="info-value">{serverIP}:3001</span>
        </div>
        <div className="info-item">
          <span className="info-label">Status:</span>
          <span className={`status-badge ${connectionStatus}`}>
            {connectionStatus}
          </span>
        </div>
      </div>

      {error && (
        <div className="error-message">{error}</div>
      )}

      <div className="controls-panel">
        {!localVideoStarted && (
          <div className="connection-section">
            <button onClick={startLocalVideo} className="btn btn-primary">
              🎥 Start Camera
            </button>
            <p style={{ textAlign: 'center', marginTop: '10px', color: '#666', fontSize: '0.9rem' }}>
              Start your camera first to see your video
            </p>
          </div>
        )}
        
        {localVideoStarted && !isConnected && (
          <div className="connection-section">
            <input
              type="text"
              placeholder="Server IP (default: localhost)"
              value={serverIP}
              onChange={(e) => setServerIP(e.target.value)}
              className="input-field"
            />
            <button onClick={connectToServer} className="btn btn-primary">
              Connect to Server
            </button>
            <button onClick={stopLocalVideo} className="btn btn-danger">
              Stop Camera
            </button>
          </div>
        )}
        
        {localVideoStarted && isConnected && (
          <div className="connection-section">
            <input
              type="text"
              placeholder={`Enter peer's IP (e.g., ${localIP || '10.7.14.51'})`}
              value={peerIP}
              onChange={(e) => setPeerIP(e.target.value)}
              className="input-field"
              disabled={isConnecting || connectionStatus === 'connected'}
            />
            <button
              onClick={connectToPeer}
              className="btn btn-success"
              disabled={isConnecting || connectionStatus === 'connected'}
            >
              {isConnecting ? 'Connecting...' : 'Connect to Peer'}
            </button>
            <button onClick={disconnect} className="btn btn-danger">
              Disconnect
            </button>
          </div>
        )}
      </div>

      <div className="video-panel">
        <div className="video-wrapper local">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video-element"
          />
          <div className="video-label">You</div>
        </div>
        <div className="video-wrapper remote">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-element"
          />
          <div className="video-label">Peer</div>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;

