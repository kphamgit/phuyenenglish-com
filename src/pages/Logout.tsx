import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { type AppDispatch } from "../redux/store";
import { logout } from "../redux/userSlice";
import { Navigate } from "react-router-dom";
import api from "../api";
//import { clear } from '../redux/connectedUsersSlice';
//import { reset } from "../redux/liveQuizIdSlice";

function Logout() {
    const dispatch = useDispatch<AppDispatch>();
    const hasLoggedOut = useRef(false);

    useEffect(() => {
        if (!hasLoggedOut.current) {
            hasLoggedOut.current = true; // Ensure logout runs only once
            // Tell the backend first (while the access token is still present, so the
            // auth header is attached) to log the logout, then clear tokens locally
            // regardless of whether that call succeeds.
            api.post("/api/logout/")
                .catch(() => { /* log out locally even if the server call fails */ })
                .finally(() => {
                    dispatch(logout());
                    localStorage.removeItem("access");
                    localStorage.removeItem("refresh");
                });
        }
    }, [dispatch]);

    return <Navigate to="/login" />;
}

export default Logout;