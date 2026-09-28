import { Temporal } from "temporal-polyfill";
import type { QuietHours } from "../domain/types";
import { type SettingsDto, type SettingsPatch, settingsToDto } from "./dto";
import type { UseCaseDeps } from "./ports";
import { type AppResult, invalid, ok } from "./result";
import { isTimeZone } from "./shared";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function getSettings(deps: UseCaseDeps): SettingsDto {
  return settingsToDto(deps.repo.getSettings());
}

/**
 * Changes the user's time zone and/or quiet hours (`quietHours: null` turns them off).
 * Takes effect from the next due nag; nags already scheduled aren't moved.
 */
export function updateSettings(deps: UseCaseDeps, patch: SettingsPatch): AppResult<SettingsDto> {
  const { repo } = deps;
  return repo.transaction(() => {
    const current = repo.getSettings();

    const timezone = patch.timezone ?? current.timezone;
    if (!isTimeZone(timezone)) return invalid(`unknown time zone: ${timezone}`, "timezone");

    let quietHours: QuietHours | null = current.quietHours;
    if (patch.quietHours !== undefined) {
      if (patch.quietHours === null) {
        quietHours = null;
      } else {
        const { start, end } = patch.quietHours;
        if (!HHMM.test(start) || !HHMM.test(end))
          return invalid("quiet hours must be HH:MM", "quietHours");
        quietHours = { start: Temporal.PlainTime.from(start), end: Temporal.PlainTime.from(end) };
      }
    }

    const settings = { timezone, quietHours };
    repo.saveSettings(settings);
    return ok(settingsToDto(settings));
  });
}
