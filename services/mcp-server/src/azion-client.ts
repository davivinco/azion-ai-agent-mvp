export class AzionClient {
  private baseUrl: string
  private token: string

  constructor(token: string, baseUrl = process.env.AZION_API_BASE_URL || "https://api.azion.com/v4") {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.token = token
  }

  async request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Authorization": `Token ${this.token}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    })

    const text = await res.text()
    const data = text ? JSON.parse(text) : null

    if (!res.ok) {
      throw new Error(JSON.stringify({
        status: res.status,
        path,
        response: data
      }, null, 2))
    }

    return data as T
  }

  get(path: string) {
    return this.request(path)
  }

  post(path: string, body: unknown) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body)
    })
  }

  patch(path: string, body: unknown) {
    return this.request(path, {
      method: "PATCH",
      body: JSON.stringify(body)
    })
  }
}
