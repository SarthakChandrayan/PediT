/**
 * Express `trust proxy` as a hop count. `true` is never used because it would let any client
 * choose req.ip through X-Forwarded-For. Render sets RENDER=true and sits one proxy hop in front.
 */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): number | false {
  const value = env.TRUST_PROXY?.trim()
  if (!value) {
    return env.RENDER === 'true' ? 1 : false
  }
  if (!/^\d{1,2}$/.test(value)) {
    throw new Error('TRUST_PROXY must be the number of trusted proxy hops, such as 1.')
  }
  const hops = Number(value)
  return hops === 0 ? false : hops
}
