import type { CSSProperties } from 'react';

export function Icon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`i${className ? ` ${className}` : ''}`} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
