# Junior Astronaut Mission Trainer

An interactive drama (a story game you steer with choices) for ages 7 to 12, made for the NASA Space Apps Challenge 2026.
Your childhood choices decide which specialist you become on a lunar outpost; you then keep the outpost alive through a
real solar storm, pulled from NASA's DONKI API, by trading power, air and shielding. The choices sit on the picture, and
every consequence is shown where it happens.

Open `index.html` from a web server (or the published site). No install, no account, nothing collected.

## Made with AI
The game's code was written with AI assistance, and the voices are AI-generated speech. Every scene carries a visible
"Made with AI" mark. The idea and direction are the team's.

## Data
`data/donki.json` holds the storm records the game draws from: flare alerts, particle events, eruption clouds and
geomagnetic storms from NASA's DONKI, pulled through api.nasa.gov (the pull date is inside the file). Other numbers come
from NASA's OSDR RadLab, OSD-766 and NTRS, and the Canadian Space Agency food toolkit. Sources are listed in the About
panel inside the game. All of it is archived data; none of it is shown as live.
