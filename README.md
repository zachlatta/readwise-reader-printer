Checks latest articles from [Readwise Reader](https://readwise.io/read) and prints out new articles.

## Setup
- clone the repo by running `git clone https://github.com/zachlatta/readwise-reader-printer.git`
- create a `.env` file
  - Set a `API_KEY` enviroment variable to your [Readwise Reader API key](https://readwise.io/access_token)
  - (optional) Set the `PRINTER_NAME` enviroment variable with the name of your printer. You can leave this blank to use a CLI.
- Run:
  ```bash
  bun install
  
  # every 1 minute or on whatever schedule
  bun run index.js
  ```
