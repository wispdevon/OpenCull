import { expect, it } from "vitest";
import { stripPhotoWidth } from "./strip-aspect";
const photo = { fullWidth: 6000, fullHeight: 4000, framing: { turn: 1, crop: null } };
it("respects portrait, rotated and cropped proportions in either strip", () => {
  expect(stripPhotoWidth(photo, 120, true)).toBe(180);
  expect(stripPhotoWidth({...photo,framing:{turn:6,crop:null}},120,true)).toBe(80);
  expect(stripPhotoWidth({...photo,framing:{turn:1,crop:{cx:0,cy:0,w:2000,h:4000,angle:0}}},120,true)).toBe(60);
  expect(stripPhotoWidth({...photo,framing:{turn:6,crop:null}},120,false)).toBe(180);
});
it("uses the original layout until usable dimensions arrive", () => {
  expect(stripPhotoWidth(undefined,120,true)).toBe(180);
  expect(stripPhotoWidth({...photo,fullHeight:0},120,true)).toBe(180);
  expect(stripPhotoWidth({...photo,fullWidth:NaN},120,true)).toBe(180);
});
