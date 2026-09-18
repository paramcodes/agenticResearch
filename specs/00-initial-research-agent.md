## Research Multi Agent

you are given an empty turbo repo, that we wants to setup for new project i am building. basically it's a multi agent system that research about given topic and returns the output as markdown.

### Step 1

For now we would just setup all the services needed. The architecture looks like this.

- Frontend - A react Project with which user will be able to interact with our system. use bun to initialise the project.
- Backend - TypeScript + Express backend which exposes the CRUD API for the frontend.
- Postgres + Prisma as Database Layer for saving user credentials and conversation history. We would write all the Prisma logic in a seperate package db and reuse this package in the backend.
- ws - websockets for streaming the messages.
- redis for states / persistent data layer
- Langchain - LangGraph for agent development

For now let's just initialise all the packages/apps. Let's write docker files for it. also write the docker compose file so that user can run locally quickly. We should also add the steps to start the project in the README. We should also update AGENTS.md to do the same. Also add .env.example files for all the projects.

### Step 2

Frontend - Landing Page to Login, Navbar have just have in the middle Home which would take to landing page and Agent which only logged users can access else it would take to login page and Signup / login in the right side of navbar or if logged in then profile as name and on clicking that 2 options as drop down profile - which would take to profile page from where users can update name, email, password. and logout. Agent page would chat page which is aligned in the center. Conversation history in the left side, and option to toggle open it or minimize it in the left side. chat section would have input in the center and enter button as svg and when someone clicks that input box would go up with animation and have option to edit it. output will render below and shown using markdown parser. since we haven't implemented streaming at this stage so progress bar would be shown and loading unless we haven't got the result then we would render the output using some markdown parser.

Backend - Add auth for email/username and google auth. agent implementation we would do later.

Also add the command in top level package.json to start project locally using docker compose.
