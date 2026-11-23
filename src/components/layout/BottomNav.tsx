import { motion } from 'motion/react';
import { Calendar, LayoutGrid, Smartphone, User } from 'lucide-react';
import { CLIMA_SPRING_EASE } from '../SpotlightCard';

export type BottomNavTab = 'remote' | 'calendar' | 'grid' | 'user';

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onSelectTab: (tab: BottomNavTab) => void;
}

const NAV_ITEMS: ReadonlyArray<{
  id: BottomNavTab;
  label: string;
  Icon: typeof Smartphone;
}> = [
  { id: 'remote', label: 'Control Remote', Icon: Smartphone },
  { id: 'calendar', label: 'Calendario', Icon: Calendar },
  { id: 'grid', label: 'Grid', Icon: LayoutGrid },
  { id: 'user', label: 'User', Icon: User },
];

export function BottomNav({ activeTab, onSelectTab }: BottomNavProps) {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed bottom-0 inset-x-0 z-40 bg-[#FFFFFF] pb-[env(safe-area-inset-bottom)]"
      style={{
        borderTop: '1px solid rgba(15, 23, 42, 0.06)',
        boxShadow: '0 -8px 24px -10px rgba(15, 23, 42, 0.07)',
      }}
    >
      <div className="max-w-lg mx-auto px-2 h-16 grid grid-cols-4 items-center">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={isActive ? 'page' : undefined}
              whileTap={{ scale: 0.92 }}
              transition={{ duration: 0.16, ease: CLIMA_SPRING_EASE }}
              className={`relative h-full min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0EA5E9] focus-visible:ring-inset ${
                isActive ? 'text-[#0EA5E9]' : 'text-[#94A3B8] hover:text-slate-500'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-active-pill"
                  aria-hidden="true"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className="absolute top-0 w-9 h-[3px] rounded-b-full bg-[#0EA5E9]"
                />
              )}

              <motion.span
                animate={{
                  y: isActive ? -1.5 : 0,
                  scale: isActive ? 1.08 : 1,
                }}
                transition={{ duration: 0.24, ease: CLIMA_SPRING_EASE }}
                className="flex items-center justify-center"
              >
                <Icon
                  className={`w-[21px] h-[21px] transition-colors duration-200 ${
                    isActive ? 'text-[#0EA5E9] stroke-[2.25]' : 'text-[#94A3B8] stroke-[1.85]'
                  }`}
                  aria-hidden="true"
                />
              </motion.span>

              <span
                className={`text-[10.5px] leading-none tracking-tight whitespace-nowrap transition-colors duration-200 ${
                  isActive ? 'font-bold text-[#0EA5E9]' : 'font-medium text-[#94A3B8]'
                }`}
              >
                {label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}
