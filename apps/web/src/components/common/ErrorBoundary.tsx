import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ZENITH] Uncaught runtime error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private sanitizeErrorMessage(msg?: string): string {
    if (!msg) return 'An unexpected UI rendering error occurred.';
    // Redact potential private keys or sensitive values
    let sanitized = msg.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_HASH_OR_KEY]');
    sanitized = sanitized.replace(/(key|secret|password)=([^\s&]+)/gi, '$1=[REDACTED]');
    return sanitized;
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const message = this.sanitizeErrorMessage(this.state.error?.message);

      return (
        <div className="min-h-screen bg-[#080B11] text-slate-100 flex items-center justify-center p-4 font-sans">
          <div className="max-w-lg w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3 mb-4 text-amber-400">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">ZENITH</h1>
                <p className="text-xs text-amber-400 font-medium">Application Runtime Notice</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <p className="text-sm text-slate-300">
                Application initialization or rendering encountered an issue.
              </p>
              <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-xl font-mono text-xs text-rose-400 break-words max-h-36 overflow-y-auto">
                {message}
              </div>
              <p className="text-xs text-slate-500">
                Open browser console for full diagnostic stack traces.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors shadow-lg shadow-cyan-500/20"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
