import { NavLink } from 'react-router';
import { cn } from '../../lib/cn.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/workspace', label: 'Courtroom', icon: 'workspace' },
  { to: '/recordings', label: 'Recordings', icon: 'waveform' },
  { to: '/documents', label: 'Documents', icon: 'document' },
  { to: '/editor', label: 'Editor', icon: 'edit' },
  { to: '/performance-lab', label: 'Performance Lab', icon: 'lab' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  /** Drawer variant (small screens) never collapses. */
  variant?: 'rail' | 'drawer';
}

export function Sidebar({ collapsed, onToggle, onNavigate, variant = 'rail' }: SidebarProps) {
  const isCollapsed = variant === 'rail' && collapsed;
  return (
    <nav aria-label="Primary" className={cn('flex h-full flex-col bg-navy-900 text-navy-100 transition-[width] duration-200', isCollapsed ? 'w-16' : 'w-60')}>
      <div className={cn('flex h-14 items-center border-b border-white/10', isCollapsed ? 'justify-center' : 'gap-2.5 px-4')}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
          <Icon name="scale" className="size-[18px]" />
        </span>
        {!isCollapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold tracking-tight text-white">CourtScribe</div>
            <div className="text-[11px] text-navy-300">Transcription POC</div>
          </div>
        )}
      </div>

      <ul className="flex-1 space-y-1 p-2">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              title={isCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex h-9 items-center rounded-md text-sm font-medium transition-colors',
                  isCollapsed ? 'justify-center' : 'gap-3 px-3',
                  isActive ? 'bg-white/12 text-white shadow-[inset_2px_0_0_0] shadow-accent-200' : 'text-navy-300 hover:bg-white/6 hover:text-white',
                )
              }
            >
              <Icon name={item.icon} />
              {!isCollapsed && <span>{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>

      {variant === 'rail' && onToggle && (
        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn('flex h-9 w-full items-center rounded-md text-xs text-navy-300 hover:bg-white/6 hover:text-white', collapsed ? 'justify-center' : 'gap-3 px-3')}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      )}
    </nav>
  );
}
