export interface SessionOpenResult {
  id: string;
  asset_name: string;
  protocol: "ssh" | "rdp" | string;
  token: string;
}

export interface RemoteSessionRow {
  id: string;
  asset_id: number | null;
  asset_name: string;
  protocol: string;
  operator: string;
  started_at: string;
  ended_at: string | null;
  has_recording: boolean;
}
