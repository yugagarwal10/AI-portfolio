# ⚙️ Setup & Installation Guide

This guide walks you through the step-by-step process of installing, configuring, and running **yug.ai** (both backend and frontend) on your local machine.

---

## 📋 Prerequisites

Before starting, ensure you have the following installed on your system:

- **Node.js** (v18.x or higher) & **npm** (v9.x or higher)
- **Python** (v3.10 or higher)
- **MongoDB** (Local instance running at `mongodb://localhost:27017` or a [MongoDB Atlas](https://www.mongodb.com/products/platform/atlas-database) cloud URI)
- **Groq API Key** (Create a free account at [console.groq.com](https://console.groq.com/) to obtain your key)

---

## 🛠️ Step 1: Clone the Repository

Clone this project to your local environment:
```bash
git clone https://github.com/yugagarwal10/AI-portfolio.git
cd AI-portfolio
```

---

## 🔌 Step 2: Backend Configuration

The backend is built with **FastAPI** and uses **Groq** (LLM API) and **MongoDB** (for chat memory).

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Create a virtual environment:**
   - **On Windows (PowerShell/CMD):**
     ```powershell
     python -m venv .venv
     .venv\Scripts\Activate.ps1
     ```
   - **On macOS / Linux:**
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install the dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up Environment Variables:**
   Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
   Open the `.env` file and configure your API keys and MongoDB settings:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   MONGO_URI=mongodb://localhost:27017
   MONGO_DB_NAME=yug_ai
   ```

5. **Start the FastAPI Backend:**
   ```bash
   python main.py
   ```
   The backend API will start on **`http://localhost:8000`**. You can verify it is running by visiting the health endpoint at `http://localhost:8000/` in your browser.

---

## 💻 Step 3: Frontend Configuration

The frontend is a modern, responsive React application built with **Vite** and **Tailwind CSS**.

1. **Open a new terminal in the project root directory:**
   ```bash
   # Make sure you are in the root directory (yug-ai-portfolio)
   ```

2. **Install node packages:**
   ```bash
   npm install
   ```

3. **Run the Vite development server:**
   ```bash
   npm run dev
   ```

4. **Access the application:**
   Open your browser and navigate to **`http://localhost:5173`**.

---

## 💾 Customizing the Knowledge Base

The AI assistant answers questions about you using the files in the `backend/data/` directory.

1. Locate the file: [yug_agarwal_master.txt](file:///c:/Users/yugag/OneDrive/Desktop/yug-ai-portfolio/backend/data/yug_agarwal_master.txt).
2. Edit or add text sections inside this directory to supply information about your skills, projects, and goals.
3. The backend is equipped with an auto-reloader (using `watchdog`). Whenever you save changes to the `.txt` files in `backend/data/`, the embedding cache will automatically refresh without restarting the server!

---

## 🔍 Troubleshooting

- **FastAPI fails to initialize RAG Engine**: Check if your `GROQ_API_KEY` is correct in the `backend/.env` file.
- **MongoDB Connection Error**: Ensure MongoDB is running locally (`net start MongoDB` on Windows or `brew services start mongodb-community` on macOS), or verify your Atlas connection URI.
- **Out of Memory / Embeddings Failure**: The local embedder (`sentence-transformers`) downloads a small 22MB model (`all-MiniLM-L6-v2`) on its first run. Ensure you have an active internet connection when running `python main.py` for the first time.
