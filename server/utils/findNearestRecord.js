/**
 * Given a target date string (YYYY-MM-DD) and an array of records with an uploadDate field,
 * returns the record whose uploadDate is closest to targetDate, within `tolerance` days.
 * Returns null if nothing falls within tolerance.
 */
export default function findNearestRecord(targetDate, allRecords, tolerance = 3) {
  const target = new Date(targetDate).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const withinTolerance = allRecords.filter(r => {
    const diff = Math.abs(new Date(r.uploadDate).getTime() - target);
    return diff <= tolerance * DAY_MS;
  });

  if (!withinTolerance.length) return null;

  return withinTolerance.sort(
    (a, b) =>
      Math.abs(new Date(a.uploadDate).getTime() - target) -
      Math.abs(new Date(b.uploadDate).getTime() - target)
  )[0];
}
