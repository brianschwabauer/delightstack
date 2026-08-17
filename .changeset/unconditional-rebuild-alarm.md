---
'@delightstack/database': patch
---

`scheduleRebuildAlarm` now arms the Durable Object alarm unconditionally, fixing a wedge where a deferred search rebuild never continued.

The old guard skipped `setAlarm` when `getAlarm()` returned a time at or before now, assuming such an alarm was about to fire. But after workerd abandons a crash-looping alarm, `getAlarm()` keeps returning that stale past timestamp even though nothing will ever fire — so the guard skipped re-arming forever, and a deferred rebuild could only advance one constructor slice per cold start. Since the rebuild never finalized, `config_version` never bumped and clients were never told to resync. Re-setting the alarm is idempotent, revives an abandoned alarm, and only ever moves a real future alarm earlier — an early fire is benign for well-behaved handlers.

If your subclass schedules its own alarms with a `getAlarm()` comparison, add a `current <= Date.now()` re-arm clause for the same reason.
