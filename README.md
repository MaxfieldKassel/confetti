# 🎉 [Confetti Website](https://🎉🎉🎉.ws) 🎉

<div align="center">
<div style="display: inline-block; width: 49%;">
    <img src="dark-mode.gif" alt="Dark Mode" style="max-width: 100%; height: auto;"/>
    Dark Mode
  </div>
<div style="display: inline-block; width: 49%;">
    <img src="light-mode.gif" alt="Light Mode" style="max-width: 100%; height: auto;"/>
    Light Mode
  </div>
  
  <br>
  <h1><a href="https://🎉🎉🎉.ws">🎉🎉🎉.ws</a></h1>
  <br>
</div>
This project is a simple web application that displays celebratory messages with confetti effects. It includes functionality for generating custom, encrypted URLs, ensuring that the message can only be viewed by opening the URL. No data is stored on the server, making the application highly scalable and secure. It also include dark and light mode that uses the users default on page open.

## Usage

### Prerequisites

- Docker and Docker Compose installed.
- Node.js installed for local development and building.

### Environment Variables

Create a `.env` file in the project root with the following variables:

The secret key is used for encrypting the messages to be stored in the URL. It has to be 32 characters long.
```
SECRET_KEY=this_is_a_valid_32_character_key
```

#### How to Generate a 32-Character Secret Key

You can generate a valid 32-character secret key using the following commands:

**macOS and Linux:**

1. Using OpenSSL:
  ```bash
    openssl rand -hex 16
  ```
   
2. Using dd:
  ```bash
    $(dd if=/dev/urandom bs=16 count=1 2>/dev/null | xxd -p -c 32)
  ```

**Windows (PowerShell):**

```powershell
  [System.BitConverter]::ToString((New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes(16)).Replace("-", "")
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

### License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
