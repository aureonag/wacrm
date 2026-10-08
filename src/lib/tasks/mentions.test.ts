import { describe, expect, it } from "vitest";
import { activeMention, extractMentionedIds, insertMention, splitMentions, type MentionMember } from "./mentions";

const members: MentionMember[] = [
  { id: "1", name: "Felipe Cordeiro Queiroz" },
  { id: "2", name: "Mídia" },
  { id: "3", name: "Nicolle Social" },
  { id: "4", name: "Mauro Soares" },
];

describe("activeMention", () => {
  it("finds people by the start of the name or of any word of it", () => {
    expect(activeMention("oi @fel", 7, members)?.matches.map((m) => m.id)).toEqual(["1"]);
    expect(activeMention("oi @cord", 8, members)?.matches.map((m) => m.id)).toEqual(["1"]);
    expect(activeMention("@m", 2, members)?.matches.map((m) => m.id)).toEqual(["2", "4"]);
  });
  it("ignores accents and case", () => {
    expect(activeMention("@midia", 6, members)?.matches.map((m) => m.id)).toEqual(["2"]);
  });
  it("a bare @ lists the first people", () => {
    expect(activeMention("@", 1, members)?.matches).toHaveLength(4);
  });
  it("is not a mention inside an e-mail or a word", () => {
    expect(activeMention("fale@midia", 10, members)).toBeNull();
  });
  it("keeps matching across a space while the name still fits", () => {
    expect(activeMention("@felipe cor", 11, members)?.matches.map((m) => m.id)).toEqual(["1"]);
    expect(activeMention("@felipe xyz", 11, members)).toBeNull();
  });
  it("closes on a new line or when nobody matches", () => {
    expect(activeMention("@fel\nabc", 8, members)).toBeNull();
    expect(activeMention("@zzz", 4, members)).toBeNull();
  });
  it("only looks at the text before the caret", () => {
    expect(activeMention("@fel e depois", 4, members)?.query).toBe("fel");
  });
});

describe("insertMention", () => {
  it("replaces the query with the full name and moves the caret after it", () => {
    const a = activeMention("oi @fel tudo bem", 7, members)!;
    const r = insertMention("oi @fel tudo bem", 7, a, members[0]);
    expect(r.text).toBe("oi @Felipe Cordeiro Queiroz  tudo bem");
    expect(r.caret).toBe("oi @Felipe Cordeiro Queiroz ".length);
  });
});

describe("extractMentionedIds", () => {
  it("returns who is still mentioned in the final text", () => {
    expect(extractMentionedIds("@Felipe Cordeiro Queiroz veja isso, @Mídia também", members).sort()).toEqual(["1", "2"]);
  });
  it("does not count a mention that was deleted or only partly typed", () => {
    expect(extractMentionedIds("falei com Felipe", members)).toEqual([]);
    expect(extractMentionedIds("@Felipe", members)).toEqual([]);
  });
  it("is accent and case insensitive", () => {
    expect(extractMentionedIds("@midia ok", members)).toEqual(["2"]);
  });
  it("is not fooled by an e-mail", () => {
    expect(extractMentionedIds("escreve para a@Mídia", members)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("separates mentions from plain text", () => {
    const parts = splitMentions("Oi @Mídia, olha @Mauro Soares isso", members);
    expect(parts.map((p) => p.text)).toEqual(["Oi ", "@Mídia", ", olha ", "@Mauro Soares", " isso"]);
    expect(parts[1].mention?.id).toBe("2");
    expect(parts[3].mention?.id).toBe("4");
  });
  it("leaves text without mentions alone", () => {
    expect(splitMentions("sem menção", members)).toEqual([{ text: "sem menção" }]);
    expect(splitMentions("@Desconhecido oi", members)).toEqual([{ text: "@Desconhecido oi" }]);
  });
});
