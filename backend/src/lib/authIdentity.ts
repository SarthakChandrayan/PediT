export type AuthIdentity = {
  authUserId: string
  email: string
}

export type ApplicationUser = {
  id: string
  authUserId: string | null
  email: string
}
