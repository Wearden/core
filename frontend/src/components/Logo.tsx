/** The Wearden mark: a rook (castle tower). Takes its color from the surrounding text color. */
export default function Logo({ className = "h-4 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 658" fill="currentColor" className={className} role="img" aria-label="Wearden">
      <path d="M0 0H100V83H200V0H300V83H400V0H500V183H0ZM50 233H450V658H50Z" />
    </svg>
  );
}
