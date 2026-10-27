import { useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";
import { ACCESS_TOKEN, REFRESH_TOKEN } from "../constants";
import LoadingIndicator from "./LoadingIndicator"
import { setUser } from "../redux/userSlice";
import { useDispatch } from "react-redux";
import { setPendingAssignments } from "../redux/pendingAssignmentsSlice";

interface FormProps {
    route: string;
    method: "login" | "register";
}
// const baseURL = import.meta.env.VITE_API_URL
function Form({ route, method }: FormProps) {

    const user_name_env = import.meta.env.VITE_USER_NAME
    const password_env = import.meta.env.VITE_PASSWORD

    //console.log("User name from env:", user_name_env);

    const [username, setUsername] = useState(user_name_env);
    const [password, setPassword] = useState(password_env);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const name = method === "login" ? "Login" : "Register";

    const dispatch = useDispatch();

    const handleSubmit = async (e: any) => {
        setLoading(true);
        e.preventDefault();

        try {
            const res = await api.post(route, { username, password })
            if (method === "login") {
                localStorage.setItem(ACCESS_TOKEN, res.data.access);
                localStorage.setItem(REFRESH_TOKEN, res.data.refresh);
                dispatch(setUser(username));

                const assignmentsRes = await api.get("/api/assignments/pending/");
                const assignments = assignmentsRes.data.pending_assignments;
                console.log("Pending assignments from server:", assignments);
                // Save assignments to Redux so the "Pending Assignments" tab appears.
                // Don't pop a modal here — let the student choose to do them via the tab.
                dispatch(setPendingAssignments(assignments ?? []));
                navigate("/");
            } else {
                navigate("/login")
            }
        } catch (error) {
            alert(error)
        } finally {
            setLoading(false)
        }
    };

    /*
{
  "assignment_id": 7,
  "quiz_id": 11,
  "category_id": 1,
  "quiz_name": "Quiz 1",
  "assigned_at": "2026-06-08T19:29:12.279087Z"
}
    */

    return (
        <>
            <form onSubmit={handleSubmit} className="form-container">
                <h1>{name}</h1>
                <input
                    className="form-input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                />
                <input
                    className="form-input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                />
                <label className="w-[90%] flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={showPassword}
                        onChange={(e) => setShowPassword(e.target.checked)}
                    />
                    Show password
                </label>
                {loading && <LoadingIndicator />}
                <button className="form-button" type="submit">
                    {name}
                </button>
            </form>
        </>
    );
}

export default Form

/*
How it redux-persist works with localStorage under the hood
When you call dispatch(setUser(name)), the data travels through this cycle:

Action Dispatched: Your component sends the name.

Reducer Updates: The userSlice updates the state in memory.

Persist Middleware: redux-persist notices the change in the user slice.

Storage: It writes the new state to localStorage.

On Refresh: When the page reloads, the PersistGate reads from localStorage and 
pushes the data back into Redux before your app finishes loading.

Verifying the Data
You can check if this is working by opening your browser's Developer Tools:

Go to the Application tab.

Select Local Storage on the left.

You should see a key named persist:root. If you look at the value, you'll see your user object serialized as a string.


*/
