import { getRoleLabel } from '@/permissions';
import { Menu, Transition } from '@headlessui/react';
import {
    ArrowRightOnRectangleIcon,
    Bars3Icon,
    BellIcon,
    CheckIcon,
    Cog6ToothIcon,
    MagnifyingGlassIcon,
    MoonIcon,
    SunIcon,
    UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '@stores/auth.store';
import clsx from 'clsx';
import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useMarkAllNotificationsRead,
    useMarkNotificationRead,
    useNotifications,
    useUnreadCount,
} from '../../hooks/useAuditNotifications';
import { useBranding } from '../ThemeProvider';

interface HeaderProps {
  onMenuClick: () => void;
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const secs = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
    return `${Math.floor(secs / 604800)}w ago`;
  } catch {
    return '';
  }
}

function NotificationBell() {
  const navigate = useNavigate();
  const { data: countData } = useUnreadCount();
  const { data: notifData } = useNotifications({ page: 1, pageSize: 5 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = countData?.count ?? 0;
  const notifications = notifData?.data ?? [];

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700 relative">
        <BellIcon className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 text-[10px] font-bold bg-error-500 text-white rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 mt-2 w-80 bg-white dark:bg-secondary-800 rounded-xl shadow-lg border border-secondary-200 dark:border-secondary-700 focus:outline-none">
          <div className="p-4 border-b border-secondary-200 dark:border-secondary-700 flex items-center justify-between">
            <h3 className="font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); markAllRead.mutate(); }}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
              >
                <CheckIcon className="w-3 h-3" />
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-secondary-500 text-sm">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <Menu.Item key={n.id}>
                  {({ active }) => (
                    <div
                      onClick={() => {
                        if (!n.isRead) markRead.mutate(n.id);
                        if (n.actionUrl) navigate(n.actionUrl);
                      }}
                      className={clsx(
                        'p-4 cursor-pointer border-b border-secondary-100 dark:border-secondary-700/50 last:border-b-0',
                        active && 'bg-secondary-50 dark:bg-secondary-700/50',
                        !n.isRead && 'bg-primary-50/50 dark:bg-primary-900/10',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <span className="w-2 h-2 mt-1.5 rounded-full bg-primary-500 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={clsx(
                            'text-sm',
                            n.isRead ? 'text-secondary-700 dark:text-secondary-300' : 'font-medium text-secondary-900 dark:text-white',
                          )}>
                            {n.title}
                          </p>
                          <p className="text-xs text-secondary-500 mt-0.5 truncate">{n.message}</p>
                          <p className="text-xs text-secondary-400 mt-1">{timeAgo(n.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </Menu.Item>
              ))
            )}
          </div>
          <div className="p-3 border-t border-secondary-200 dark:border-secondary-700">
            <Menu.Item>
              {({ active }) => (
                <button
                  onClick={() => navigate('/notifications')}
                  className={clsx(
                    'w-full text-sm text-primary-600 hover:text-primary-700 font-medium rounded-lg py-1',
                    active && 'bg-secondary-50 dark:bg-secondary-700/50',
                  )}
                >
                  View all notifications
                </button>
              )}
            </Menu.Item>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

export default function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { themeMode, toggleTheme } = useBranding();
  const [searchOpen, setSearchOpen] = useState(false);

  const isDark = themeMode === 'dark';

  const handleToggleTheme = () => {
    toggleTheme();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-20 border-b border-secondary-200 dark:border-secondary-700" style={{ backgroundColor: 'var(--header-bg)', color: 'var(--header-text)' }}>
      <div className="flex items-center justify-between h-16 px-4 lg:px-6">
        {/* Left section */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700 lg:hidden"
          >
            <Bars3Icon className="w-6 h-6" />
          </button>

          {/* Search */}
          <div className="hidden sm:block relative">
            <div
              className={clsx(
                'flex items-center transition-all duration-200',
                searchOpen ? 'w-80' : 'w-64',
              )}
            >
              <MagnifyingGlassIcon className="absolute left-3 w-5 h-5 text-secondary-400" />
              <input
                type="text"
                placeholder="Search plans, forecasts..."
                className="input pl-10 pr-4"
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setSearchOpen(false)}
              />
              <kbd className="absolute right-3 hidden lg:inline-flex items-center px-2 py-0.5 text-xs font-medium text-secondary-400 bg-secondary-100 dark:bg-secondary-700 rounded">
                ⌘K
              </kbd>
            </div>
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2">
          {/* Mobile search button */}
          <button className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700 sm:hidden">
            <MagnifyingGlassIcon className="w-5 h-5" />
          </button>

          {/* Theme toggle */}
          <button
            onClick={handleToggleTheme}
            className="p-2 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700"
            title="Toggle theme"
          >
            {isDark ? (
              <SunIcon className="w-5 h-5" />
            ) : (
              <MoonIcon className="w-5 h-5" />
            )}
          </button>

          {/* Notifications */}
          <NotificationBell />

          {/* User menu */}
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-secondary-100 dark:hover:bg-secondary-700">
              <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900 rounded-full flex items-center justify-center">
                <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                  {user?.firstName?.[0]}
                  {user?.lastName?.[0]}
                </span>
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-secondary-500">{getRoleLabel(user?.role)}</p>
              </div>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 mt-2 w-56 bg-white dark:bg-secondary-800 rounded-xl shadow-lg border border-secondary-200 dark:border-secondary-700 focus:outline-none">
                <div className="p-3 border-b border-secondary-200 dark:border-secondary-700">
                  <p className="text-sm font-medium">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="text-xs text-secondary-500">{user?.email}</p>
                </div>
                <div className="p-1">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => navigate('/settings/profile')}
                        className={clsx(
                          'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg',
                          active && 'bg-secondary-100 dark:bg-secondary-700',
                        )}
                      >
                        <UserCircleIcon className="w-5 h-5" />
                        Profile
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => navigate('/settings')}
                        className={clsx(
                          'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg',
                          active && 'bg-secondary-100 dark:bg-secondary-700',
                        )}
                      >
                        <Cog6ToothIcon className="w-5 h-5" />
                        Settings
                      </button>
                    )}
                  </Menu.Item>
                </div>
                <div className="p-1 border-t border-secondary-200 dark:border-secondary-700">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={handleLogout}
                        className={clsx(
                          'flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg text-error-600',
                          active && 'bg-error-50 dark:bg-error-900/20',
                        )}
                      >
                        <ArrowRightOnRectangleIcon className="w-5 h-5" />
                        Sign out
                      </button>
                    )}
                  </Menu.Item>
                </div>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </div>
    </header>
  );
}
