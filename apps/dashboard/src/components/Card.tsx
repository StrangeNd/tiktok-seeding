import type { ReactNode } from 'react';

export function Card({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
