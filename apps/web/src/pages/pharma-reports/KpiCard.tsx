import clsx from 'clsx';

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'gray';
}

const colorMap = {
  blue: { bg: 'bg-blue-50 dark:bg-blue-950/35', icon: 'text-blue-600 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-900/60' },
  green: { bg: 'bg-green-50 dark:bg-green-950/35', icon: 'text-green-600 dark:text-green-300', border: 'border-green-200 dark:border-green-900/60' },
  red: { bg: 'bg-red-50 dark:bg-red-950/35', icon: 'text-red-600 dark:text-red-300', border: 'border-red-200 dark:border-red-900/60' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950/35', icon: 'text-amber-600 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900/60' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-950/35', icon: 'text-purple-600 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-900/60' },
  gray: { bg: 'bg-gray-50 dark:bg-secondary-900/80', icon: 'text-gray-600 dark:text-secondary-200', border: 'border-gray-200 dark:border-secondary-700' },
};

export default function KpiCard({ title, value, subtitle, icon, color = 'blue' }: KpiCardProps) {
  const c = colorMap[color];
  return (
    <div className={clsx('rounded-xl border p-5 transition-shadow hover:shadow-md', c.bg, c.border)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-500 dark:text-secondary-400">{title}</p>
          <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 dark:text-secondary-400">{subtitle}</p>}
        </div>
        <div className={clsx('rounded-lg bg-white/80 p-2.5 dark:bg-secondary-900/70', c.icon)}>
          {icon}
        </div>
      </div>
    </div>
  );
}
