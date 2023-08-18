import http from 'http'
import { Server } from 'socket.io'
import { CLIENT_EVENTS, SERVER_EVENTS, TYPING_DURATION } from './websocket.const.js'
import { CustomServer } from './websocket.types.js'
import { registerUser, setOnlineStatus, users } from '../state/users.js'
import { getEmptyChatForClient } from '../state/chats.util.js'
import {
	addMessage,
	getChat,
	getOrCreateChat,
	markAsSeen,
	setTypingStatus,
} from '../state/chats.js'

export const setupWebsockets = (server: http.Server) => {
	const io: CustomServer = new Server(server, {
		cors: {
			origin: process.env.CLIENT_URL,
		},
	})

	io.on(CLIENT_EVENTS.connection, (socket) => {
		socket.on(CLIENT_EVENTS.userOnline, (user) => {
			const userCreated = registerUser(user)

			socket.data.user = users[user.id]
			socket.join(user.id)

			if (userCreated) {
				socket.broadcast.emit(SERVER_EVENTS.newChat, getEmptyChatForClient(socket.data.user))
			} else {
				setOnlineStatus(user.id, true)
				socket.broadcast.emit(SERVER_EVENTS.userOnline, user.id)
			}

			socket.on(CLIENT_EVENTS.startTyping, (otherUserId) => {
				const chat = getChat(user.id, otherUserId)

				if (chat) {
					const index = chat.userIDs.indexOf(user.id)
					if (!chat.typingState[index].isTyping)
						socket.to(otherUserId).emit(SERVER_EVENTS.startTyping, user.id)

					const timeout = setTimeout(() => {
						socket.to(otherUserId).emit(SERVER_EVENTS.endTyping, user.id)

						setTypingStatus(user.id, otherUserId, false)
					}, TYPING_DURATION)

					setTypingStatus(user.id, otherUserId, true, timeout)
				}
			})

			socket.on(CLIENT_EVENTS.newMessage, (otherUserId, message) => {
				const chat = getOrCreateChat(user.id, otherUserId)

				if (message.trim()) {
					const addedMessage = addMessage(chat, message, user.id)

					setTypingStatus(user.id, otherUserId, false)
					markAsSeen(chat, user.id, addedMessage.id)

					io.to(otherUserId).emit(SERVER_EVENTS.newMessage, user.id, addedMessage)
					io.to(user.id).emit(SERVER_EVENTS.newMessage, otherUserId, addedMessage)
				}
			})

			socket.on(CLIENT_EVENTS.seen, (otherUserId, lastSeenMessageID) => {
				const chat = getChat(user.id, otherUserId)

				if (chat) {
					const index = chat.userIDs.indexOf(user.id)
					markAsSeen(chat, user.id, lastSeenMessageID)
					socket.to(otherUserId).emit(SERVER_EVENTS.seen, user.id, chat.seen[index])
				}
			})
		})

		socket.on(CLIENT_EVENTS.disconnect, () => {
			const { user } = socket.data

			if (user) {
				setOnlineStatus(user.id, false)
				socket.broadcast.emit(SERVER_EVENTS.userOffline, user.id)
			}
		})
	})
}
