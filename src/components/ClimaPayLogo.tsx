import { useState } from 'react';
import { Snowflake } from 'lucide-react';

const CLIMAPAY_FULL_SRC = '/assets/climapay-full.png';
const CLIMAPAY_ISOTIPO_SRC = '/assets/climapay-isotipo.png';

interface ClimaPayLogoProps {
  variant?: 'card' | 'horizontal';
  size?: 'sm' | 'md' | 'lg';
  inverted?: boolean;
  className?: string;
}

export function ClimaPayLogo({
  variant = 'horizontal',
  size = 'md',
  inverted = false,
  className = '',
}: ClimaPayLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // Stacked transparent lockup (AuthView & Loading splash) — zero box, zero border, zero shadow
  if (variant === 'card') {
    const heightClass =
      size === 'lg' ? 'h-28 w-auto' : size === 'sm' ? 'h-20 w-auto' : 'h-24 w-auto';

    return (
      <div className={`inline-flex items-center justify-center bg-transparent select-none ${className}`}>
        {!imgFailed ? (
          <img
            src={CLIMAPAY_FULL_SRC}
            alt="ClimaPay"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`${heightClass} object-contain bg-transparent ${
              inverted ? 'brightness-0 invert' : 'mix-blend-multiply'
            }`}
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5">
            <Snowflake
              className={`w-9 h-9 stroke-[2] ${inverted ? 'text-white' : 'text-[#0EA5E9]'}`}
              aria-hidden="true"
            />
            <span
              className={`text-xl font-extrabold tracking-tight leading-none ${
                inverted ? 'text-white' : 'text-[#0F172A]'
              }`}
            >
              Clima
              <span className={inverted ? 'text-sky-100 font-semibold' : 'text-[#0EA5E9] font-semibold'}>
                Pay
              </span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // Horizontal frameless transparent lockup (App Header, Paywall, Remote, Success View)
  const markSizeClass =
    size === 'sm' ? 'h-7 w-auto' : size === 'lg' ? 'h-10 w-auto' : 'h-8 w-auto';

  const textSizeClass =
    size === 'sm' ? 'text-[16px]' : size === 'lg' ? 'text-[20px]' : 'text-[18px]';

  return (
    <div
      className={`inline-flex items-center gap-2 whitespace-nowrap shrink-0 bg-transparent select-none ${className}`}
    >
      {!imgFailed ? (
        <img
          src={CLIMAPAY_ISOTIPO_SRC}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${markSizeClass} object-contain shrink-0 bg-transparent ${
            inverted ? 'brightness-0 invert' : 'mix-blend-multiply'
          }`}
          draggable={false}
        />
      ) : (
        <Snowflake
          className={`w-5 h-5 stroke-[2.1] shrink-0 ${inverted ? 'text-white' : 'text-[#0EA5E9]'}`}
          aria-hidden="true"
        />
      )}

      <span
        className={`${textSizeClass} font-extrabold tracking-tight leading-none ${
          inverted ? 'text-white' : 'text-[#0F172A]'
        }`}
      >
        Clima
        <span className={inverted ? 'text-sky-100 font-semibold' : 'text-[#0EA5E9] font-semibold'}>
          Pay
        </span>
      </span>
    </div>
  );
}
