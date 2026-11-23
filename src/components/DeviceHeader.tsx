import { CloudOff, Loader2, LogOut, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { ClimaPayLogo } from './ClimaPayLogo';

interface DeviceHeaderProps {
  online: boolean | null;
  hasError: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  userEmail: string;
  userDisplayName: string;
  onRefresh: () => void;
  onSignOut: () => void;
}

export function DeviceHeader({
  online,
  hasError,
  isLoading,
  isRefreshing,
  userEmail,
  userDisplayName,
  onRefresh,
  onSignOut,
}: DeviceHeaderProps) {
  const renderConnectionText = () => {
    if (isLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap shrink-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0EA5E9]" aria-hidden="true" />
          <span>Sincronizando</span>
        </span>
      );
    }
    if (online === false) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 whitespace-nowrap shrink-0">
          <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sin conexión</span>
        </span>
      );
    }
    if (hasError) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 whitespace-nowrap shrink-0">
          <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Sin respuesta</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0EA5E9] whitespace-nowrap shrink-0">
        <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
        <span>En línea</span>
      </span>
    );
  };

  return (
    <header
      className="sticky top-0 z-30 bg-white/65 backdrop-blur-md"
      style={{ borderBottom: '1px solid rgba(15, 23, 42, 0.055)' }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Zone 1: Official ClimaPay Brand Lockup */}
        <div className="flex items-center min-w-0">
          <ClimaPayLogo variant="horizontal" size="md" />
        </div>

        {/* Zone 2: Clean Unboxed Connection & User Identity */}
        <div className="hidden sm:flex items-center gap-2.5 text-xs text-slate-500 min-w-0">
          {renderConnectionText()}
          <span aria-hidden="true" className="text-slate-300">
            ·
          </span>
          <span className="truncate max-w-[220px] text-slate-600 font-medium">
            {userDisplayName || userEmail}
          </span>
        </div>

        {/* Zone 3: Tactile Utility Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Actualizar estado"
            aria-label="Actualizar estado"
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:text-[#0F172A] hover:bg-white/80 active:scale-95 transition-transform duration-150 ease-clima cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#0EA5E9]' : ''}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={onSignOut}
            title={`Cerrar sesión (${userEmail})`}
            aria-label="Cerrar sesión"
            className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-xl text-xs font-semibold text-slate-600 hover:text-rose-600 hover:bg-white/80 active:scale-95 transition-transform duration-150 ease-clima whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}
