import MetallicPaint from "./MetallicPaint";
import Logo from "./Logo";

// The rook mark as a white image for the metallic shader.
const ROOK = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 658" width="500" height="658"><path fill="#fff" d="M0 0H100V83H200V0H300V83H400V0H500V183H0ZM50 233H450V658H50Z"/></svg>');

let webgl2: boolean | undefined;
/** MetallicPaint needs WebGL 2; without it the plain mark and word are shown instead of an empty box. */
const canMetal = () => {
  if (webgl2 === undefined) {
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
};
// Follows Wearden's Animations setting, and the system's reduce-motion setting when that is "System".
const still = () => {
  const pref = document.documentElement.dataset.motion;
  return pref === "off" || (pref !== "on" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
};
const light = () => document.documentElement.dataset.theme === "light";

/** The Wearden rook in liquid chrome (React Bits MetallicPaint). */
export function MetalMark({ size = 32 }: { size?: number }) {
  if (!canMetal()) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-950" style={{ width: size, height: size }}>
        <Logo className="h-[18px] w-auto" />
      </span>
    );
  }
  return (
    <span className="block shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <MetallicPaint imageSrc={ROOK} scale={0.95} mouseTilt={0.3} paused={still()} lightMode={light()} />
    </span>
  );
}

/** A word in liquid chrome, for the product name. */
export function MetalWord({ text, width = 112, height = 24 }: { text: string; width?: number; height?: number }) {
  if (!canMetal()) return <span className="block text-base font-semibold tracking-tight text-slate-50">{text}</span>;
  return (
    <span className="block" style={{ width, height }} role="img" aria-label={text}>
      <MetallicPaint text={text} fontWeight={700} fontFamily={getComputedStyle(document.body).fontFamily} scale={0.95} mouseTilt={0.3} paused={still()} lightMode={light()} />
    </span>
  );
}
