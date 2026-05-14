import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AiReportingAssistant } from '../reports/AiReportingAssistant';
import Header from './Header';
import Sidebar from './Sidebar';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    return stored === 'true';
  });

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-900">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={handleToggleCollapse}
      />

      {/* Main content */}
      <div
        className={`transition-all duration-300 min-h-screen flex flex-col ${
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        <Header
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex-1 p-2.5 sm:p-3 lg:p-4 overflow-x-hidden">
          <Outlet />
        </main>
        <AiReportingAssistant />
      </div>
    </div>
  );
}
