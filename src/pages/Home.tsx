import { useState, useEffect, useRef } from "react";
import "../styles/Home.css"
import { Link } from "react-router-dom";
//import { type RootState } from "../redux/store";
//import { useSelector } from "react-redux";
import ChatPage, { type ChatPageRefProps, type ChatProps } from "../components/chat/ChatPage";
import { useWebSocket } from "../components/context/WebSocketContext";
import { useSelector } from 'react-redux';
//import MessageControl from "./MessageControl";
//import type { WebSocketMessageProps } from "../components/shared/types";
import HomeTeacher from "./HomeTeacher";
import HomeStudent from "./HomeStudent";
import HomeAdmin from "./HomeAdmin";
import api from "../api";
import { FaAngleDoubleLeft } from "react-icons/fa";
import { useUserConnections } from "../components/context/UserConnectionsContext";
import MessageController from "./MessageController";
import type { ReceivedConnectedUserDataProps, WebSocketMessageProps } from "../components/shared/types";

function Home() {

    //const state = useSelector((state: RootState) => state);
 
    //const user_name = useSelector((state: RootState) => state.name);
    //const { name, isLoggedIn } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
    //const rehydrated = useSelector((state: RootState) => state._persist?.rehydrated); //
    const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);

    // Which home to show is based on the user's real role (is_staff), not the username. We fetch
    // it once; until it loads we hold off on the teacher/student choice to avoid a flash.
    const [isStaff, setIsStaff] = useState(false);
    const [roleLoaded, setRoleLoaded] = useState(false);

    useEffect(() => {
        api.get("/api/me/")
            .then((res) => setIsStaff(!!res.data.is_staff))
            .catch(() => setIsStaff(false))
            .finally(() => setRoleLoaded(true));
    }, []);

    const [isChatOpen, setIsChatOpen] = useState<boolean | null>(false); // start closed on mount

    const [chatMessage, setChatMessage] = useState<ChatProps>({ text: '', user_name: '' });

    //const [liveQuestionNumber, setLiveQuestionNumber] = useState<string | undefined>(undefined);

    //const [otherConnectedUsers, setOtherConnectedUsers] = useState<any[]>([]);
    //const [liveQuizId, setLiveQuizId] = useState<string | null>(null);

    // Callback to receive updated userRows from UserConnections
   
    const chatPageRef = useRef<ChatPageRefProps>(null);

    //const {userRows, setUserRows, liveQuizId, setLiveQuizId} = useUserConnections();

    const {eventEmitter} = useWebSocket();
  
    const {setUserRows, setLiveQuizId, setLiveQuestionNumber} = useUserConnections();
    
    //const wsUrl = `${import.meta.env.VITE_WS_PROTOCOL}://${import.meta.env.VITE_WS_URL}/ws/socket-server/${name}/`;
    //const wsUrl = `${import.meta.env.VITE_WS_PROTOCOL}://${import.meta.env.VITE_WS_URL}/${name}/`;   

        useEffect(() => {
            const handleMessage = (data: WebSocketMessageProps) => {
                //console.log("HOME: handleMessage called with data:", data);
                if (data.message_type === "welcome_message") {
                    //console.log("MessageController: welcome_message ALLLLLL connected_users:", data.connected_users);
                    const connectedUsersFromServer = data.connected_users as ReceivedConnectedUserDataProps[];
                    // git console.log("MessageController: welcome_message, other connected_users from server:", connectedUsersFromServer);
                    // set user rows using connectedUsersFromServer,
                    setUserRows(connectedUsersFromServer.map((user) => ({ name: user.name })));
                    if (data.live_quiz_id) {
                        //console.log("************ MessageController: welcome_message live_quiz_id:", data.live_quiz_id);
                        setLiveQuizId(data.live_quiz_id);
                    }
                    if (data.live_question_number) {
                        //console.log("************ HOME: welcome_message live_question_number:", data.live_question_number);
                        setLiveQuestionNumber?.(Number(data.live_question_number));
                    }
                } //
                else if (data.message_type === "user_disconnected") {
                    //console.log("MessageController: Received user_disconnected message from server for user:", data.user_name);
                    const dropped_user = data.user_name;
                    // remove dropped_user from userRows,
                    setUserRows((prevRows) => prevRows.filter((row) => row.name !== dropped_user));
                    
                }
                if (data.message_type === "another_user_joined") {
                    setUserRows((prevRows) => {
                            // skip if this user is already in the list (e.g. duplicate connection/reconnect)
                            if (prevRows.some((row) => row.name === data.user_name)) {
                                return prevRows;
                            }
                            return [...prevRows, { name: data.user_name}]; // add new user to the list with is_logged_in set to true
                    })
                }
                if (data.message_type === "chat") {
                    //console.log("MessageController: Received chat message from server:. ");
                    // Ignore our own broadcast echo (the sender already shows its own message).
                    if (data.user_name === name) return;
                    // SR (speech-recognition) prompts are handled centrally by HomeStudent — shown
                    // centered with a fixed mic — not in the chat box, so don't open/route them here.
                    if ((data.content ?? '').toString().trim().startsWith("SR")) return;
                    setIsChatOpen((prevIsChatOpen) => {
                        if (!prevIsChatOpen) {
                            //console.log("Home: Chat box is closed. Opening chat box to display new message.");
                            return true; // Open the chat box
                        }
                        return prevIsChatOpen; // Keep the current state
                    });
                    //console.log("Home: Received chat message from server, setting chatMessage state to:", { text: data.content, user_name: data.user_name });
                    setChatMessage({ text: data.content, user_name: data.user_name, audio_url: data.audio_url });
                }
            }
            // Subscribe to the "message" event
            eventEmitter?.on("message", handleMessage);
            // Cleanup the event listener on unmount
            return () => {
                eventEmitter?.off("message", handleMessage);
            };
        }, [eventEmitter]); // Only include eventEmitter in the dependency array



    useEffect(() => {
       //console.log("Home: Setting up storage event listener for logout detection across tabs...");
        const handleStorageChange = (event: StorageEvent) => {
           //console.log("Storage event detected:", event);
            if (event.key === "persist:root") {
               //console.log("LocalStorage &&&&&& changed by redux-persist:", event.newValue);
                // this is what you see in localStorage when redux-persist saves the state
                //persist:root = `{"user":"{\"name\":null,\"isLoggedIn\":false}","_persist":"{\"version\":-1,\"rehydrated\":true}"}`;
                // Parse the new value of persist:root
                if (event.newValue) {
                    const persistedState = JSON.parse(event.newValue);
                    //console.log("Parsed persisted state:", persistedState);
                    const userState = JSON.parse(persistedState.user || "{}");
                    //console.log("Updated user state from localStorage:", userState);
                    // check isLoggedIn value, if false, meaning user logged out from another tab,
                    // then reload this tab to reflect the logout state
                    if (userState.isLoggedIn === false) {
                       //console.log("User logged out in another tab, reloading this tab...");
                        // reload the page which will redirect to login page
                        window.location.reload();
                    }

                    // You can perform additional actions here, such as updating the component state
                    // or triggering a Redux action if needed.
                }

            }
        };
        // Add the event listener
        window.addEventListener("storage", handleStorageChange);
        // Cleanup the event listener on component unmount
        return () => {
           //console.log("Home: Cleaning up storage event listener...");
            window.removeEventListener("storage", handleStorageChange);
        };
    }, []);

    
    const toggleChatBox = (value?: boolean) => {
        setIsChatOpen((prev) => value !== undefined ? value : !prev);
    }

    
    const renderHomeContent = () => {
        if (name === 'admin') {
            return <HomeAdmin  />;
        }
        // Wait for the role before choosing, so a teacher doesn't briefly flash the student home.
        if (!roleLoaded) {
            return null;
        }
        if (isStaff) {   // teachers (is_staff) get the teacher home + dictionary editing
            return <HomeTeacher />;
        }
        return <HomeStudent />;
      };

    return (
            <div className="relative min-h-screen">

                <div className="text-red-800 mx-10 my-8">Welcome
                    <span className="font-bold"> {name}</span> to
                    <span className="text-blue-600"> tienganhphuyen.com</span>
                    <span className='text-md bg-amber-400 text-sm ml-3 p-2'>
                        <Link to="/logout">Log out</Link>
                    </span>
                </div>
                <div className="flex flex-row justify-left mb-2 ml-10 items-center bg-cyan-200 px-2">
                    <span className="text-lg bg-green-200 text-red-800 font-bold">{name}</span>
                    <MessageController />

                </div>
             
               
      
                {renderHomeContent()

                }
                { isChatOpen === true &&  <ChatPage ref={chatPageRef} chat = {chatMessage} onClose={() => toggleChatBox(false)} />}
                { !isChatOpen &&
                    <button
                        onClick={() => toggleChatBox(true)}
                        aria-label="Open chat"
                        title="Open chat"
                        className="absolute right-0 bottom-15 h-[268px] w-6 z-20 flex items-center justify-center bg-blue-300 hover:bg-blue-400 rounded-l-md shadow-md"
                    >
                        <FaAngleDoubleLeft />
                    </button>
                }

            </div>
       
    );
}

export default Home;
