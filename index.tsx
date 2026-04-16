
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Error Handling Spec for Firestore Operations
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse((this as any).state.error?.message || "");
        if (parsed.error) message = `Database Error: ${parsed.error}`;
      } catch (e) {}

      return (
        <div className="h-full w-full flex flex-col items-center justify-center p-8 bg-[#02040a] text-center">
          <h1 className="text-4xl font-black text-red-500 mb-4">SYSTEM ERROR</h1>
          <p className="text-white/60 mb-8 max-w-md">{message}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="gold-button px-8 py-3 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #fcd34d 0%, #fbbf24 40%, #d97706 100%)',
              color: '#451a03',
              fontWeight: 900,
              textTransform: 'uppercase',
              padding: '12px 32px',
              borderRadius: '12px'
            }}
          >
            REBOOT SYSTEM
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
