import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";

/** The signed-in user's own profile (display name, contact details, picture). */
export function useProfile() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["profile"], queryFn: api.profile, enabled: !!user, staleTime: 60_000 });
}

/** The display name when one is set, otherwise the username. */
export function DisplayName() {
  const { user } = useAuth();
  const profile = useProfile();
  return <>{profile.data?.display_name || user?.username}</>;
}

/** The user's picture, or the first letter of their name. `src` and `name` override the stored profile (for previews). */
export default function UserAvatar({ size = 32, src, name }: { size?: number; src?: string; name?: string }) {
  const { user } = useAuth();
  const profile = useProfile();
  const picture = src !== undefined ? src : profile.data?.avatar;
  const label = name ?? (profile.data?.display_name || user?.username || "?");
  if (picture) return <img src={picture} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-950" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {label[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
