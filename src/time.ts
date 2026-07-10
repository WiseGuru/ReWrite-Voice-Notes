import { moment } from 'obsidian';

// Obsidian re-exports its bundled moment, but the export's TYPE comes from the
// `moment` package (a transitive dependency of `obsidian`), which the community
// review bot's lint environment does not resolve: `obsidian` itself types fine
// there, `moment` does not, so every direct `moment(...)` call is error-typed and
// trips the bot's no-unsafe-* rules. All timestamp formatting therefore goes
// through this narrow structural alias (the same pattern as ScriptProcessorNodeLike
// and WakeLockLike), which needs nothing from moment's own typings. Runtime
// behavior is unchanged: it is still Obsidian's bundled moment doing the work.
interface MomentLike {
	format(fmt: string): string;
}

type MomentFactory = (input?: Date) => MomentLike;

export function formatMoment(fmt: string, input?: Date): string {
	return (moment as unknown as MomentFactory)(input).format(fmt);
}
