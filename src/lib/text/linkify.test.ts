import { describe, expect, it } from "vitest";
import { linkifyText } from "./linkify";

describe("linkifyText", () => {
  it("returns the whole text as one plain part when there is no URL", () => {
    expect(linkifyText("sem link nenhum aqui")).toEqual([{ text: "sem link nenhum aqui" }]);
  });

  it("splits a URL out of surrounding text", () => {
    expect(linkifyText("Tem LP https://scarlletmery.com.br sim")).toEqual([
      { text: "Tem LP " },
      { text: "https://scarlletmery.com.br", href: "https://scarlletmery.com.br" },
      { text: " sim" },
    ]);
  });

  it("recognizes a bare www. link and adds the protocol only to href", () => {
    expect(linkifyText("veja www.exemplo.com.br")).toEqual([
      { text: "veja " },
      { text: "www.exemplo.com.br", href: "https://www.exemplo.com.br" },
    ]);
  });

  it("trims trailing sentence punctuation off the URL", () => {
    expect(linkifyText("olha https://exemplo.com.")[1]).toEqual({
      text: "https://exemplo.com",
      href: "https://exemplo.com",
    });
    expect(linkifyText("(veja https://exemplo.com/pagina)")[1]).toEqual({
      text: "https://exemplo.com/pagina",
      href: "https://exemplo.com/pagina",
    });
  });

  it("keeps a closing paren that belongs to the URL itself", () => {
    const parts = linkifyText("https://pt.wikipedia.org/wiki/Exemplo_(desambiguação)");
    expect(parts[0].href).toBe("https://pt.wikipedia.org/wiki/Exemplo_(desambiguação)");
  });

  it("handles several links in the same text", () => {
    const parts = linkifyText("um https://a.com e outro https://b.com fim");
    expect(parts.filter((p) => p.href)).toHaveLength(2);
    expect(parts.map((p) => p.text).join("")).toBe("um https://a.com e outro https://b.com fim");
  });

  it("never drops or duplicates characters, even with punctuation-heavy text", () => {
    const text = "Dores:\n- Tem LP https://scarlletmery.com.br, e mais.";
    expect(linkifyText(text).map((p) => p.text).join("")).toBe(text);
  });
});
