import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface InfoTooltipProps {
  content: string;
  /** Optional: wider tooltip for longer explanations */
  wide?: boolean;
}

/**
 * A small ⓘ icon that shows a tooltip on hover with an explanation.
 * Uses a portal so it's never clipped by overflow:hidden containers.
 */
export function InfoTooltip({ content, wide = false }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLButtonElement>(null);

  function show() {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 6,
      left: rect.left + window.scrollX + rect.width / 2,
    });
    setVisible(true);
  }

  function hide() {
    setVisible(false);
  }

  // Hide on scroll
  useEffect(() => {
    if (!visible) return;
    const handler = () => setVisible(false);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [visible]);

  return (
    <>
      <button
        ref={iconRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
        aria-label="More information"
        type="button"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
      </button>

      {visible && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: pos.top,
            left: pos.left,
            transform: 'translateX(-50%)',
            zIndex: 9999,
            width: wide ? 280 : 220,
            pointerEvents: 'none',
          }}
        >
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            top: -5,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 10,
            height: 10,
            background: '#1e293b',
            clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)',
          }} />
          <div style={{
            background: '#1e293b',
            color: '#f1f5f9',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 11,
            lineHeight: 1.5,
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          }}>
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
