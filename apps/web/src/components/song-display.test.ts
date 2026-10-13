import { describe, expect, it } from "vitest";

import { displaySong } from "./song-display";

describe("displaySong", () => {
  it.each([
    ["Brandi Carlile - The Story - Piano", "Beethoven80", "The Story", "Brandi Carlile"],
    ["Nothing More - Just Say When - Piano Cover", "Dadebryant", "Just Say When", "Nothing More"],
    ["Coldplay - Fix You (ADVANCED piano cover)", "Katherine Cordova", "Fix You", "Coldplay"],
    ["The Greatest Showman - \"From Now On\" [Piano Tutorial] (Synthesia)", "Jon Pumper", "From Now On", "The Greatest Showman"],
    ["Nocturne", "F. F. Chopin", "Nocturne", "F. F. Chopin"],
    ["30 Seconds 2 Mars Bright Lights", "Unknown", "30 Seconds 2 Mars Bright Lights", ""],
  ])("%s", (title, artist, shownTitle, shownArtist) => {
    expect(displaySong(title, artist)).toEqual({ title: shownTitle, artist: shownArtist });
  });
});
