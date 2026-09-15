export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={`i${className ? ` ${className}` : ''}`} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
