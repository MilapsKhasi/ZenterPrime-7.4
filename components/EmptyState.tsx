
import React from 'react';
import { Plus, Search, FolderSearch } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: any;
}

const EmptyState: React.FC<EmptyStateProps> = ({ 
  title = "No Data Found", 
  message = "Start creating by clicking the button below!", 
  actionLabel, 
  onAction,
  icon: Icon = FolderSearch
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="relative mb-8">
        {/* Decorative background circle */}
        <div className="absolute inset-0 bg-slate-100 rounded-full scale-150 opacity-50 blur-2xl"></div>
        
        {/* Custom Illustration SVG inspired by the user prompt */}
        <div className="relative w-64 h-64 flex items-center justify-center">
            <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-sm">
                <rect x="40" y="80" width="120" height="80" rx="4" fill="#7c3aed" />
                <path d="M40 85 L160 85 L160 160 L40 160 Z" fill="#6d28d9" />
                <rect x="60" y="50" width="80" height="40" rx="2" fill="white" stroke="#E2E8F0" strokeWidth="1" />
                <circle cx="85" cy="65" r="3" fill="#94A3B8" />
                <circle cx="115" cy="65" r="3" fill="#94A3B8" />
                <path d="M90 75 Q100 82 110 75" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
                <g transform="translate(130, 110) rotate(-15)">
                    <circle cx="0" cy="0" r="25" fill="white" stroke="#0F172A" strokeWidth="3" />
                    <line x1="18" y1="18" x2="40" y2="40" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
                </g>
                <text x="20" y="40" className="font-bold text-4xl fill-slate-300">?</text>
                <text x="170" y="60" className="font-bold text-2xl fill-slate-200">?</text>
            </svg>
        </div>
      </div>
      
      <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2 capitalize">{title}</h3>
      <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto mb-8 font-medium leading-relaxed">
        {message}
      </p>
      
      {onAction && actionLabel && (
        <button 
          onClick={onAction}
          className="bg-primary text-white px-8 py-3 rounded-md font-bold text-sm hover:bg-primary-dark transition-all flex items-center shadow-lg active:scale-95 capitalize"
        >
          <Plus className="w-4 h-4 mr-2" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
