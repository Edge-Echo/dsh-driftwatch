import type { Context } from '@deepseek-ai/cordis';
/** Plugin config. */
export interface DriftwatchConfig {
    /** Cap retained tool calls per session (keeps reports bounded). */
    maxToolCalls?: number;
}
declare const _default: ((ctx: Context, config?: DriftwatchConfig) => void) & {
    inject: string[];
};
export default _default;
