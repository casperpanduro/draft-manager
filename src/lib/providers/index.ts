// Provider registry — resolve a `SportsProvider` by its key. Add a sport later
// by registering its adapter here (and a `sports` row with provider_config).

import { ApiFootballProvider } from "./api-football";
import type { ProviderConfig, SportsProvider } from "./types";

export type { SportsProvider, ProviderConfig } from "./types";
export type {
  ProviderLeague,
  ProviderClub,
  ProviderPlayer,
  ProviderEvent,
} from "./types";

export function getProvider(key: string, config: ProviderConfig = {}): SportsProvider {
  switch (key) {
    case "api-football":
      return new ApiFootballProvider(config);
    default:
      throw new Error(`Unknown provider: ${key}`);
  }
}
