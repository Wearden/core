import type { CSSProperties, ReactNode } from "react";

export type CallChipStatus = "running" | "done" | "error" | "idle";

export interface CallChipProps {
  icon?: "terminal" | "file" | "search" | "edit" | ReactNode;
  name?: string;
  argument?: string;
  status?: CallChipStatus;
  expectedMs?: number;
  size?: number;
  radius?: number;
  color?: string;
  surfaceColor?: string;
  progressColor?: string;
  progressOpacity?: number;
  doneColor?: string;
  errorColor?: string;
  washOpacity?: number;
  shake?: number;
  showTimer?: boolean;
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
}

export default function CallChip(props: CallChipProps): JSX.Element;
