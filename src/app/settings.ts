import { Temporal } from "temporal-polyfill";
import type { QuietHours } from "../domain/types";
import { type SettingsDto, type SettingsPatch, settingsToDto } from "./dto";
import type { UseCaseDeps } from "./ports";
import { type AppResult, invalid, ok } from "./result";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function isTimeZone(tz: string): boolean {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

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
    if (!isTimeZone(timezone)) return invalid(`unknown time zone: ${timezone}`);

    let quietHours: QuietHours | null = current.quietHours;
    if (patch.quietHours !== undefined) {
      if (patch.quietHours === null) {
        quietHours = null;
      } else {
        const { start, end } = patch.quietHours;
        if (!HHMM.test(start) || !HHMM.test(end)) return invalid("quiet hours must be HH:MM");
        quietHours = { start: Temporal.PlainTime.from(start), end: Temporal.PlainTime.from(end) };
      }
    }

    const settings = { timezone, quietHours };
    repo.saveSettings(settings);
    return ok(settingsToDto(settings));
  });
}
