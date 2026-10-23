import React, { useState } from 'react';
import { Plus } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: any;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ 
  title = "No transactions found!", 
  message, 
  subtitle,
  actionLabel = "Create New", 
  onAction,
  className = ""
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const displaySubtitle = message || subtitle || "Start creating your first or selected filter's first transaction.";

  return (
    <div className={`flex flex-col items-center justify-center py-16 sm:py-24 px-4 text-center select-none ${className}`}>
      {/* Folder with Question Mark Graphic matching uploaded design */}
      <div className="relative mb-6 flex items-center justify-center">
        {!imgFailed ? (
          <img 
            src="/assets/empty-folder-icon.png" 
            alt="No transactions found" 
            onError={() => setImgFailed(true)}
            className="w-24 sm:w-28 h-auto object-contain drop-shadow-sm select-none" 
          />
        ) : (
          <svg viewBox="0 0 102 78" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-24 sm:w-28 h-auto select-none">
            <path
              d="M7 11C7 6.02944 11.0294 2 16 2H39.5C41.8869 2 44.1762 2.94821 45.864 4.63604L50.364 9.13604C52.0518 10.8239 54.3411 11.7721 56.7279 11.7721H90C94.9706 11.7721 99 15.8015 99 20.7721V68C99 72.9706 94.9706 77 90 77H16C11.0294 77 7 72.9706 7 68V11Z"
              fill="#4F46E5"
            />
            <path
              d="M84.5 13.5C89.1944 13.5 93 17.3056 93 22C93 25.1091 91.3323 27.8288 88.8574 29.3037C86.7323 30.5706 85.5 32.35 85.5 34.5V36H81.5V34.5C81.5 30.95 83.4 28.5 86.85 26.4C88.15 25.6 89 24.1 89 22C89 19.5147 86.9853 17.5 84.5 17.5C82.0147 17.5 80 19.5147 80 22H76C76 17.3056 79.8056 13.5 84.5 13.5ZM83.5 41C82.1193 41 81 42.1193 81 43.5C81 44.8807 82.1193 46 83.5 46C84.8807 46 86 44.8807 86 43.5C86 42.1193 84.8807 41 83.5 41Z"
              fill="white"
            />
          </svg>
        )}
      </div>
      
      {/* Title */}
      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight">
        {title}
      </h3>

      {/* Subtitle Message */}
      <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md mx-auto mb-6 font-normal leading-relaxed">
        {displaySubtitle}
      </p>
      
      {/* Primary Action Button */}
      {onAction && (
        <button 
          type="button"
          onClick={onAction}
          className="bg-[#4338ca] hover:bg-[#3730a3] text-white px-5 py-2.5 rounded-lg font-medium text-xs sm:text-sm transition-all flex items-center justify-center shadow-xs active:scale-95 cursor-pointer gap-1.5"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{actionLabel || "Create New"}</span>
        </button>
      )}
    </div>
  );
};

export default EmptyState;
