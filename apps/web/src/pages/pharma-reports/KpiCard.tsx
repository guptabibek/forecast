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
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', border: 'border-blue-200' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', border: 'border-green-200' },
  red: { bg: 'bg-red-50', icon: 'text-red-600', border: 'border-red-200' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', border: 'border-amber-200' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', border: 'border-purple-200' },
  gray: { bg: 'bg-gray-50', icon: 'text-gray-600', border: 'border-gray-200' },
};

export default function KpiCard({ title, value, subtitle, icon, color = 'blue' }: KpiCardProps) {
  const c = colorMap[color];
  return (
    <div className={clsx('rounded-xl border p-5 transition-shadow hover:shadow-md', c.bg, c.border)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className={clsx('rounded-lg p-2.5', c.bg, c.icon)}>
          {icon}
        </div>
      </div>
    </div>
  );
}
