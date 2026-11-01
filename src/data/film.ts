// The launch film, shown full screen on a first visit to Home (src/components/FilmIntro.astro).
// The two video files live in the R2 bucket `openislet-media`, served at /media/ by site-worker/media.js. The poster is a
// static file in public/film/. A new cut: make its two web copies (1920 and 1280 wide, H.264 with the index at the front, so
// playing can start at once), upload both to the bucket, add its poster, then change the names here. Each cut keeps its own
// file names, so browsers never mix two cuts.
export const film = {
  cut: 'v34',
  minutes: 3,
  /** Computers. */
  large: '/media/openislet-film-v34-1080p.mp4',
  /** Phones, and anything with a small screen: about 17 MB instead of 28. */
  small: '/media/openislet-film-v34-720p.mp4',
  poster: '/film/openislet-film-v34-poster.jpg',
};
