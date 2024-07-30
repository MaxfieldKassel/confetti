# 🎉 [Confetti Website](https://🎉🎉🎉.ws) 🎉

This project is a simple web application that displays celebratory messages with confetti effects. It includes functionalities for generating custom URLs with encrypted messages and serving the site using Docker.

## Offical Site

[🎉🎉🎉.ws](https://🎉🎉🎉.ws)

## Project Structure

- `build.js`: Script to minify JavaScript files from the `src` directory and output them to the `dist` directory.
- `dist/`: Directory containing the minified CSS and JavaScript files.
- `docker-compose.yml`: Docker Compose configuration file for running the web server.
- `Dockerfile`: Dockerfile for building the project image.
- `LICENSE`: The MIT License for this project.
- `package.json`: Project dependencies and build scripts.
- `private/`: Directory containing server-side scripts and views.
  - `messages.json`: JSON file with daily motivational messages.
  - `server.js`: Express server handling routes and encryption.
  - `views/index.ejs`: EJS template for rendering the homepage.
- `src/`: Directory containing source JavaScript files.
  - `app.js`: Client-side JavaScript for handling confetti effects and custom URL generation.

## Usage

### Prerequisites

- Docker and Docker Compose installed.
- Node.js installed for local development and building.

### Environment Variables

Create a `.env` file in the project root with the following variables:

```
SECRET_KEY=your_secret_key
LINKEDIN_URL=your_linkedin_url
LINKEDIN_NAME=your_name
```

### Building and Running

#### Using Docker

1. Build and run the Docker containers:
    ```
    docker-compose up --build
    ```

2. Access the web application at `http://localhost:5612`.

#### Local Development

1. Install dependencies:
    ```
    npm install
    ```

2. Build the project:
    ```
    npm run build
    ```

3. Start the server:
    ```
    node private/server.js
    ```

4. Access the web application at `http://localhost`.

### Directory Descriptions

#### `build.js`

This script reads JavaScript files from the `src` directory, minifies them using `UglifyJS`, and outputs the minified files to the `dist` directory. It ensures the output directory exists before writing the minified files.

#### `dist/styles.css`

Contains styles for the web application, including layout settings for the confetti effect and link elements.

#### `docker-compose.yml`

Defines the Docker service for the web application, exposing it on port 5612.

#### `Dockerfile`

Multi-stage build Dockerfile to install dependencies, build the project, and prepare the production environment.

#### `private/messages.json`

Contains a list of motivational messages displayed on the homepage based on the day of the year.

#### `private/server.js`

Express server handling the main routes:
- Home route (`/`): Renders the homepage with a motivational message.
- Custom URL generation (`/generate-url`): Generates a custom URL with an encrypted message.
- Custom text route (`/custom/:text`): Decrypts and displays the custom message.

### Example Custom URL

To generate a custom URL, enter a message in the input box and click "Generate". The application creates an encrypted URL that displays the custom message when accessed.

### License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.