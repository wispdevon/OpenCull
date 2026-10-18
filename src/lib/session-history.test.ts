import { describe, expect, it } from "vitest";
import { latestSession, type RecentSession } from "./session-history";
const card = (id: string, updatedAt: number): RecentSession => ({id,updatedAt,name:id,sources:["/card"],count:1,stage:"review",cover:null});
describe("resume latest session", () => {
  it("chooses the most recently used session regardless of kind or list order", () => {
    expect(latestSession([card("a",1),card("b",3)],{path:"/folder",updatedAt:2})).toEqual({kind:"card",id:"b"});
    expect(latestSession([card("a",1)],{path:"/folder",updatedAt:2})).toEqual({kind:"folder",path:"/folder"});
  });
  it("keeps the first card for equal timestamps and prefers it over an equally recent folder", () => {
    const cards = [card("first", 4), card("second", 4)];
    expect(latestSession(cards, {path:"/folder",updatedAt:4})).toEqual({kind:"card",id:"first"});
    expect(cards.map((session) => session.id)).toEqual(["first", "second"]);
  });
  it("does not reorder the card list when finding its latest session", () => {
    const cards = [card("older", 1), card("newer", 3)];
    expect(latestSession(cards, null)).toEqual({kind:"card",id:"newer"});
    expect(cards.map((session) => session.id)).toEqual(["older", "newer"]);
  });
  it("ignores cards without finite timestamps", () => {
    expect(latestSession([card("invalid", Number.NaN), card("old", 2), card("infinite", Infinity)], null)).toEqual({kind:"card",id:"old"});
    expect(latestSession([card("invalid", Number.NaN)], null, "/old-folder")).toEqual({kind:"folder",path:"/old-folder"});
  });
  it("supports existing recent folders and ignores malformed preferences", () => {
    expect(latestSession([],null,"/old-folder")).toEqual({kind:"folder",path:"/old-folder"});
    expect(latestSession([], {path:"/bad",updatedAt:"wrong"})).toBeNull();
    expect(latestSession([],null)).toBeNull();
  });
});
