import { cookies } from "next/headers";

/** The viewer's time zone, saved by <TimeZoneCookie/> in their browser. Pages render on UTC servers. */
export async function viewerTz(): Promise<string> {
  const tz = (await cookies()).get("tz")?.value;
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {
    // unknown zone name
  }
  return "America/New_York";
}

export interface TimeFmt {
  tz: string;
  dateTime: (d: string | Date | null | undefined) => string;
  date: (d: string | Date | null | undefined) => string;
  time: (d: string | Date | null | undefined, withDay?: boolean) => string;
}

/** Formatters in the viewer's time zone. */
export async function timeFmt(): Promise<TimeFmt> {
  const tz = await viewerTz();
  const f = (o: Intl.DateTimeFormatOptions) => (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("en-US", { timeZone: tz, ...o }) : "—");
  const time = f({ hour: "numeric", minute: "2-digit" });
  const timeDay = f({ weekday: "short", hour: "numeric", minute: "2-digit" });
  return {
    tz,
    dateTime: f({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    date: f({ month: "short", day: "numeric", year: "numeric" }),
    time: (d, withDay = false) => (withDay ? timeDay(d) : time(d)),
  };
}
