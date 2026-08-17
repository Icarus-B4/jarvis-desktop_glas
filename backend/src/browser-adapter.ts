export type JarvisWebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type JarvisWebPageContent = {
  url: string;
  title: string;
  content: string;
};

export type JarvisBrowserAdapter = {
  fetchPageContent(url: string): Promise<JarvisWebPageContent>;
  searchWeb(query: string, maxResults?: number): Promise<JarvisWebSearchResult[]>;
};

export class DefaultJarvisBrowserAdapter implements JarvisBrowserAdapter {
  private tavilyApiKey: string;

  constructor(tavilyApiKey?: string) {
    this.tavilyApiKey = tavilyApiKey ?? process.env.TAVILY_API_KEY ?? "";
  }

  async fetchPageContent(urlStr: string): Promise<JarvisWebPageContent> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    } catch {
      throw new Error("Ungültige Web-Adresse (URL).");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Nur HTTP und HTTPS Protokolle werden unterstützt.");
    }

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 JARVIS/1.0",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new Error(`Webseite antwortet mit Status ${response.status}`);
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    const rawText = await response.text();

    if (contentType.includes("json")) {
      return {
        url: parsedUrl.toString(),
        title: "JSON Data Response",
        content: rawText.slice(0, 6000),
      };
    }

    // HTML Bereinigung & Text-Extraktion
    const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : parsedUrl.hostname;

    let cleanHtml = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");

    // HTML Tags in Absätze umwandeln
    cleanHtml = cleanHtml
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n### $1\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n\n$1\n")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ");

    // HTML Entities decodieren & Mehrfach-Leerzeichen stützen
    const cleanText = cleanHtml
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\r?\n\s*\r?\n/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    return {
      url: parsedUrl.toString(),
      title,
      content: cleanText.slice(0, 8000),
    };
  }

  async searchWeb(query: string, maxResults = 4): Promise<JarvisWebSearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    // 1. Primär: Tavily Search API wenn API-Key vorhanden
    if (this.tavilyApiKey) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: this.tavilyApiKey,
            query: trimmedQuery,
            max_results: maxResults,
            include_answer: false,
          }),
          signal: AbortSignal.timeout(6_000),
        });

        if (res.ok) {
          const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
          if (Array.isArray(data.results) && data.results.length > 0) {
            return data.results.map((r) => ({
              title: r.title ?? "Unbenanntes Ergebnis",
              url: r.url ?? "",
              snippet: (r.content ?? "").slice(0, 350),
            }));
          }
        }
      } catch (err) {
        console.warn("Tavily Search API fehlgeschlagen, nutze Fallback:", err);
      }
    }

    // 2. Fallback: DuckDuckGo HTML Search Scraping
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmedQuery)}`;
      const res = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(6_000),
      });

      if (res.ok) {
        const html = await res.text();
        const results: JarvisWebSearchResult[] = [];
        const resultRegex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

        let match: RegExpExecArray | null;
        while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
          const rawUrl = (match[1] ?? "").trim();
          const snippet = (match[2] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          let title = "Web Result";

          // Titel extrahieren falls möglich
          const titleMatch = html.slice(Math.max(0, match.index - 300), match.index).match(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          }

          results.push({
            title,
            url: rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl,
            snippet,
          });
        }

        if (results.length > 0) return results;
      }
    } catch (err) {
      console.warn("DuckDuckGo Fallback-Suche fehlgeschlagen:", err);
    }

    return [];
  }
}
