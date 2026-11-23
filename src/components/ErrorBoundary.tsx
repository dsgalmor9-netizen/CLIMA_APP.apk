import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ocurrió un error inesperado en la interfaz.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex items-center justify-center p-6">
          <div className="alabaster-card max-w-md w-full rounded-[28px] p-7 text-center">
            <div
              className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4"
              style={{ border: '1px solid rgba(225, 29, 72, 0.16)' }}
            >
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[#0F172A]">Algo salió mal</h1>
            <p className="mt-2 text-xs font-mono text-slate-500 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-cyan-luminous mt-5 inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-2xl text-xs font-semibold text-white transition-transform duration-150 ease-clima active:scale-[0.98] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
