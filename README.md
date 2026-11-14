# Junior Astronaut Mission Trainer

An interactive film for ages 7 to 12, made for the NASA Space Apps Challenge 2026.
Your childhood choices decide which specialist you become on a lunar outpost; you then steer the crew through a real
solar storm from NASA's DONKI archive by trading power, air and shielding.

Open `index.html` from a web server (or the published site). No install, no account, nothing collected.

## How it was made, and where AI was used
- **Picture:** every frame is drawn by a program (three.js scenes rendered frame by frame in headless Chrome, encoded
  with ffmpeg). The program was written with AI assistance (Claude Fable 5.2, Anthropic). No AI image or video
  generator was used. Every clip carries a "Made with AI" mark.
- **Voices:** AI-generated speech (Kokoro-82M, open source, run locally).
- **Music and effects:** synthesized in code (earshot sound bank, open source).
- **Player and text:** written with AI assistance. The idea and direction are the team's.

## Data
Archived NASA data (DONKI, OSDR RadLab, OSD-766, NTRS) and the Canadian Space Agency food toolkit. Sources are listed
in the About panel inside the film. None of it is shown as live.
